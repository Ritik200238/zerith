import { PausedFeature } from "@/components/shared/PausedFeature";

export default function AllowlistPausedPage() {
  return (
    <PausedFeature
      name={'Allowlist gate'}
      summary={'Merkle-proof membership checks for gated sales.'}
    />
  );
}
