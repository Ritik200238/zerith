import { PausedFeature } from "@/components/shared/PausedFeature";

export default function VickreyPausedPage() {
  return (
    <PausedFeature
      name={'Vickrey auctions'}
      summary={'Second-price sealed-bid auctions.'}
    />
  );
}
