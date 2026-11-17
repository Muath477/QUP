import { Inject, Injectable } from "@nestjs/common";
import { type ChatReplyKind, studyChat } from "@qup/ai-gateway";

import { APP_CONFIG, type AppConfig } from "../../../config/app-config.js";
import { EXAM_ACCESS, type ExamAccess } from "../../billing/billing.contract.js";
import { CATALOG_LOOKUP, type CatalogLookup } from "../../catalog/catalog.contract.js";
import {
  SETTINGS_READER,
  type SettingsReader,
  STUDY_CHAT_RULES_KEY,
} from "../../settings/settings.contract.js";
import { AiChatLimitReached, AiRequiresSubscription, AiStudyChatOff } from "../domain/ai.errors.js";
import {
  AI_RUN_STORE,
  type AiRunStore,
  CHAT_STORE,
  type ChatMessageView,
  type ChatStore,
} from "../domain/ports.js";
import { AiRunner } from "./ai-runner.service.js";
import { KnowledgeService } from "./knowledge.service.js";

/** The longest message a student may send; the controller enforces it too. */
export const CHAT_MESSAGE_MAX_CHARS = 1000;
/** Messages a student may send per day, across exams; a cost and abuse bound. */
export const CHAT_MESSAGES_PER_DAY = 40;
/** Earlier turns the model sees with a new message. */
const CHAT_CONTEXT_TURNS = 8;
/** Turns a student sees when they open the chat. */
const CHAT_HISTORY_SHOWN = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUBJECT_EXAM = "exam";

export interface ChatReplyView {
  /** The student's message and the reply, as saved. */
  messages: ChatMessageView[];
  kind: ChatReplyKind;
  /** Titles of the library entries the reply was grounded on. */
  sources: string[];
}

/**
 * The study chat (AI_INTEGRATION.md "Study Chat"): a subscriber asks about
 * preparing for one exam; the reply follows fixed rules in code plus the
 * admins' rules (settings), and is grounded on passages retrieved from the
 * exam's knowledge library. The conversation is stored server side, so the
 * model only ever sees what was really said.
 */
@Injectable()
export class StudyChatService {
  constructor(
    private readonly runner: AiRunner,
    private readonly knowledge: KnowledgeService,
    @Inject(AI_RUN_STORE) private readonly runs: AiRunStore,
    @Inject(CHAT_STORE) private readonly chats: ChatStore,
    @Inject(EXAM_ACCESS) private readonly access: ExamAccess,
    @Inject(CATALOG_LOOKUP) private readonly catalog: CatalogLookup,
    @Inject(SETTINGS_READER) private readonly settings: SettingsReader,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  enabled(): boolean {
    return this.config.ai.studyChat && this.runner.providerName !== null;
  }

  async history(studentId: string, examId: string): Promise<ChatMessageView[]> {
    await this.assertSubscribed(studentId, examId);
    return this.chats.history(studentId, examId, CHAT_HISTORY_SHOWN);
  }

  async send(studentId: string, examId: string, message: string): Promise<ChatReplyView> {
    if (!this.config.ai.studyChat) throw new AiStudyChatOff();
    this.runner.assertAvailable();
    await this.assertSubscribed(studentId, examId);

    const today = await this.runs.countByRequesterSince(
      studyChat.name,
      studentId,
      new Date(Date.now() - DAY_MS),
    );
    if (today >= CHAT_MESSAGES_PER_DAY) throw new AiChatLimitReached(CHAT_MESSAGES_PER_DAY);

    const [names, history, rules, references] = await Promise.all([
      this.catalog.examNames([examId]),
      this.chats.history(studentId, examId, CHAT_CONTEXT_TURNS),
      this.settings.current(STUDY_CHAT_RULES_KEY),
      this.knowledge.chatReferences(examId, message),
    ]);
    const output = await this.runner.run(
      studyChat,
      {
        examName: names.get(examId) ?? "",
        platformRules: [...rules.value.rules],
        references,
        history: history.map((turn) => ({
          role: turn.role === "STUDENT" ? ("student" as const) : ("assistant" as const),
          text: turn.content,
        })),
        message,
      },
      { type: SUBJECT_EXAM, id: examId },
      studentId,
    );
    const messages = await this.chats.append(studentId, examId, [
      { role: "STUDENT", content: message },
      { role: "ASSISTANT", content: output.reply },
    ]);
    return {
      messages,
      kind: output.kind,
      sources: output.kind === "ANSWERED" ? [...new Set(references.map((r) => r.title))] : [],
    };
  }

  async clear(studentId: string, examId: string): Promise<void> {
    await this.chats.clear(studentId, examId);
  }

  private async assertSubscribed(studentId: string, examId: string): Promise<void> {
    if (!(await this.access.hasExamAccess(studentId, examId))) throw new AiRequiresSubscription();
  }
}
