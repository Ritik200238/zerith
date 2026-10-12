import { PausedFeature } from "@/components/shared/PausedFeature";

export default function TradePausedPage() {
  return (
    <PausedFeature
      name={'Trading'}
      summary={'An order book with encrypted limit prices.'}
    />
  );
}
