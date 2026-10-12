import { PausedFeature } from "@/components/shared/PausedFeature";

export default function MultisigPausedPage() {
  return (
    <PausedFeature
      name={'Confidential multisig'}
      summary={'Group approvals over encrypted proposal amounts.'}
    />
  );
}
