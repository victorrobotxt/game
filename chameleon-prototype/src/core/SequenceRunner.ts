/**
 * `SequenceRunner` is the hackathon name for the starter's `CommandQueue`:
 * a skippable presentation queue where skip() means "jump to the end state", never "cancel".
 */
export { CommandQueue as SequenceRunner, CommandContext as SequenceContext } from './CommandQueue';
export type { Command as SequenceStep, CommandOptions as SequenceStepOptions } from './CommandQueue';
