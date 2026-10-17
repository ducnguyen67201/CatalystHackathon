import type { AnswerReview, Brief, TranscriptTurn } from '../contracts/Workspace.js';
export function reviewAnswer(brief: Brief, turns: TranscriptTurn[]): AnswerReview {
  const answer = turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.text)
    .join(' ')
    .trim();
  const text = answer.toLowerCase();
  const requirements = [
    { name: 'operating performance', present: /operat/.test(text) },
    { name: 'cash-flow context', present: /cash|runway|forecast/.test(text) },
  ];
  if (Number(brief.finding.credit) > 0) {
    requirements.push({
      name: 'the credit included in net income',
      present: /credit|sr.?ed/.test(text),
    });
  }
  return {
    answer,
    covered: requirements.filter((item) => item.present).map((item) => item.name),
    missing: requirements.filter((item) => !item.present).map((item) => item.name),
    note: 'Key-topic check only. It does not verify your spoken numbers or reasoning. Compare with the sourced financial explanation.',
  };
}
export function nextPracticeQuestion(brief: Brief, turns: TranscriptTurn[]): string {
  const answer =
    turns
      .filter((turn) => turn.role === 'user')
      .at(-1)
      ?.text.toLowerCase() ?? '';
  if (!answer) {
    return brief.finding.question;
  }
  if (Number(brief.finding.credit) > 0 && !/credit|sr.?ed/.test(answer)) {
    return 'The reported net income includes an SR&ED credit. How would you explain the operating result separately?';
  }
  if (!/cash|runway|forecast/.test(answer)) {
    return 'What cash-flow information would you need before explaining how long the company can operate?';
  }
  return 'What evidence would show whether the improvement can continue, and what will you check before the next meeting?';
}
