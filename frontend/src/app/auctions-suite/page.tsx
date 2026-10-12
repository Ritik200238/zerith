import { PausedFeature } from "@/components/shared/PausedFeature";

export default function AuctionsSuitePausedPage() {
  return (
    <PausedFeature
      name={'The auction suite'}
      summary={'An overview of the Vickrey, Dutch, batch and overflow auction formats. Sealed-bid block sales are live on the Block Sales page.'}
    />
  );
}
