import { PausedFeature } from "@/components/shared/PausedFeature";

export default function WrapperPausedPage() {
  return (
    <PausedFeature
      name={'The token wrapper'}
      summary={'Wrapping public ERC-20 tokens into confidential ones.'}
    />
  );
}
