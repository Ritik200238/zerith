import { PausedFeature } from "@/components/shared/PausedFeature";

export default function StreamingPausedPage() {
  return (
    <PausedFeature
      name={'Payment streams'}
      summary={'Per-second payments at an encrypted rate.'}
    />
  );
}
