import type {
  InvestorProfileEstimateInput,
  InvestorProfileEstimateOutput,
} from '../contracts/InvestorProfileEstimate.js';

export interface InvestorProfileProvider {
  readonly model: string;
  generate(input: InvestorProfileEstimateInput): Promise<InvestorProfileEstimateOutput>;
}
