import { PausedFeature } from "@/components/shared/PausedFeature";

export default function ReputationPausedPage() {
  return (
    <PausedFeature
      name={'Reputation'}
      summary={'Scores computed over encrypted trade history.'}
    />
  );
}
