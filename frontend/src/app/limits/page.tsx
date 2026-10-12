import { PausedFeature } from "@/components/shared/PausedFeature";

export default function LimitsPausedPage() {
  return (
    <PausedFeature
      name={'Limit orders'}
      summary={'Orders with encrypted trigger prices.'}
    />
  );
}
