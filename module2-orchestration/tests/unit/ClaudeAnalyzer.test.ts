import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { ClaudeAnalyzer } from '../../src/analyzers/ClaudeAnalyzer';
import type { AnalyzerInput } from '../../src/analyzers/ClaudeAnalyzer';
import { Logger } from '../../src/utils/Logger';
import type { DataProviderOutput } from '../../src/validators/outputValidator';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

const mockProviderOutput: DataProviderOutput = {
  data: {
    results: [{ chain: 'sepolia', blockNumber: 12345, balance: '1000000000000000000' }],
  },
  metadata: {
    chains: ['sepolia'],
    timestamp: new Date().toISOString(),
    provider: 'Goldsky',
    queryDuration: 500,
  },
};

const defaultInput: AnalyzerInput = {
  data: mockProviderOutput,
  schemaHash: '0x' + 'ab'.repeat(32),
};

function makeClaudeResponse(result: object, confidence: number, reasoning: string) {
  return {
    data: {
      content: [
        {
          text: JSON.stringify({ result, confidence, reasoning }),
        },
      ],
      usage: { input_tokens: 1000, output_tokens: 500 },
    },
  };
}

describe('ClaudeAnalyzer', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createSilentLogger();
  });

  describe('analyze success', () => {
    it('should return structured AnalyzerOutput on success', async () => {
      mockedAxios.post.mockResolvedValueOnce(
        makeClaudeResponse({ score: 87, tier: 'prime' }, 0.85, 'Wallet shows consistent behavior'),
      );

      const analyzer = new ClaudeAnalyzer({ apiKey: 'test-key' }, logger);
      const result = await analyzer.analyze(defaultInput);

      expect(result.confidence).toBe(0.85);
      expect(result.reasoning).toBe('Wallet shows consistent behavior');
      expect(result.metadata.model).toBe('claude-sonnet-4-5-20250929');
      expect(result.metadata.tokensUsed).toBe(1500);
      expect(result.metadata.processingTime).toBeGreaterThanOrEqual(0);
    });

    it('should call Claude API with correct headers', async () => {
      mockedAxios.post.mockResolvedValueOnce(
        makeClaudeResponse({ score: 50 }, 0.7, 'Analysis complete'),
      );

      const analyzer = new ClaudeAnalyzer({ apiKey: 'sk-ant-test-key' }, logger);
      await analyzer.analyze(defaultInput);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user' }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-test-key',
            'anthropic-version': '2023-06-01',
          }),
        }),
      );
    });

    it('should extract JSON from markdown code blocks', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          content: [
            {
              text: '```json\n{"result": {"score": 75}, "confidence": 0.9, "reasoning": "Good wallet"}\n```',
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const analyzer = new ClaudeAnalyzer({ apiKey: 'test-key' }, logger);
      const result = await analyzer.analyze(defaultInput);

      expect(result.confidence).toBe(0.9);
      expect((result.result as { score: number }).score).toBe(75);
    });
  });

  describe('low confidence warning', () => {
    it('should log warning when confidence is below threshold', async () => {
      mockedAxios.post.mockResolvedValueOnce(
        makeClaudeResponse({ score: 30 }, 0.3, 'Uncertain analysis'),
      );

      const warnSpy = vi.spyOn(logger, 'warn');
      const analyzer = new ClaudeAnalyzer({ apiKey: 'test-key', confidenceThreshold: 0.5 }, logger);
      await analyzer.analyze(defaultInput);

      expect(warnSpy).toHaveBeenCalledWith(
        'Low confidence analysis result',
        expect.objectContaining({ event: 'ANALYZER_LOW_CONFIDENCE' }),
      );
    });

    it('should use custom threshold from input options', async () => {
      mockedAxios.post.mockResolvedValueOnce(
        makeClaudeResponse({ score: 60 }, 0.7, 'OK analysis'),
      );

      const warnSpy = vi.spyOn(logger, 'warn');
      const analyzer = new ClaudeAnalyzer({ apiKey: 'test-key', confidenceThreshold: 0.5 }, logger);
      await analyzer.analyze({
        ...defaultInput,
        options: { confidenceThreshold: 0.8 },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        'Low confidence analysis result',
        expect.objectContaining({ event: 'ANALYZER_LOW_CONFIDENCE' }),
      );
    });
  });

  describe('error handling', () => {
    it('should throw on empty API response', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { content: [] },
      });

      const analyzer = new ClaudeAnalyzer({ apiKey: 'test-key' }, logger);
      await expect(analyzer.analyze(defaultInput)).rejects.toThrow('Empty response from Claude API');
    });

    it('should throw on invalid JSON in response', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          content: [{ text: 'This is not JSON at all' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const analyzer = new ClaudeAnalyzer({ apiKey: 'test-key' }, logger);
      await expect(analyzer.analyze(defaultInput)).rejects.toThrow();
    });

    it('should throw on invalid confidence value', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          content: [{ text: '{"result": {}, "confidence": 2.0, "reasoning": "test"}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const analyzer = new ClaudeAnalyzer({ apiKey: 'test-key' }, logger);
      await expect(analyzer.analyze(defaultInput)).rejects.toThrow('Invalid confidence value');
    });

    it('should throw on missing reasoning', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          content: [{ text: '{"result": {}, "confidence": 0.8}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const analyzer = new ClaudeAnalyzer({ apiKey: 'test-key' }, logger);
      await expect(analyzer.analyze(defaultInput)).rejects.toThrow('Missing reasoning');
    });

    it('should retry on network errors', async () => {
      mockedAxios.post
        .mockRejectedValueOnce(new Error('timeout of 60000ms exceeded'))
        .mockResolvedValueOnce(
          makeClaudeResponse({ score: 80 }, 0.9, 'Retry succeeded'),
        );

      const analyzer = new ClaudeAnalyzer({ apiKey: 'test-key' }, logger);
      const result = await analyzer.analyze(defaultInput);

      expect(result.confidence).toBe(0.9);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('name', () => {
    it('should return Claude', () => {
      const analyzer = new ClaudeAnalyzer({ apiKey: 'test-key' }, logger);
      expect(analyzer.name).toBe('Claude');
    });
  });
});
