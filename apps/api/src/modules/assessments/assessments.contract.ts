import type { RichContent } from "../questions/questions.contract.js";

/**
 * Public read contract of assessments for other modules (AGENTS.md §5).
 * Owned here: ai → assessments, never back.
 */

/** A student's latest wrong training answer on one question, with its answer key (server only). */
export interface StudentMistake {
  questionVersionId: string;
  answeredAt: Date;
  skillName: string | null;
  stem: RichContent;
  options: { key: string; content: RichContent; isCorrect: boolean }[];
  chosenKeys: string[];
  /** The reviewed explanation, when the question has one. */
  explanation: RichContent | null;
}

export interface StudentMistakes {
  /**
   * The student's latest wrong training answer on the question, or null when
   * they never got it wrong in training. Refuses students without access.
   */
  mistakeOf(
    studentId: string,
    examId: string,
    questionVersionId: string,
  ): Promise<StudentMistake | null>;
}

export const STUDENT_MISTAKES = Symbol("STUDENT_MISTAKES");
