import { Message, ModelSettings } from '@deprecated-claude/shared';

const WORDS = ['bees', 'watermelon', 'juniper'];

export class MockModelService {
  async streamCompletion(
    modelId: string,
    messages: Message[],
    systemPrompt: string | undefined,
    settings: ModelSettings,
    onChunk: (chunk: string, isComplete: boolean) => Promise<void>,
    _stopSequences?: string[]
  ): Promise<void> {
    const text = (this.repeatWord() + ' ' + this.repeatWord() + ' ' + this.repeatWord()).trim();
    const chunks = text.split(/\s+/g);

    for (const word of chunks) {
      await this.sleep(100 + Math.random() * 120);
      await onChunk(word + ' ', false);
    }
    await this.sleep(60 + Math.random() * 60);
    await onChunk('', true);
  }

  private repeatWord(): string {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const count = 6 + Math.floor(Math.random() * 12);
    return Array(count).fill(word).join(' ');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
