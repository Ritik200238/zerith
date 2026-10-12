import { PausedFeature } from "@/components/shared/PausedFeature";

export default function BatchPausedPage() {
  return (
    <PausedFeature
      name={'Batch auctions'}
      summary={'Uniform-price clearing for many encrypted orders at once.'}
    />
  );
}
