import { PausedFeature } from "@/components/shared/PausedFeature";

export default function AgentPausedPage() {
  return (
    <PausedFeature
      name={'The Zerith agent'}
      summary={'A natural-language assistant that turned requests like “auction 500 tokens” into encrypted transactions.'}
    />
  );
}
