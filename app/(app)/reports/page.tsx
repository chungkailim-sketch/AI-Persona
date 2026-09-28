import { NotYetBuilt } from '@/ui/BuildStatus';

export const metadata = { title: 'Reports · Persona Intelligence' };

export default function Page() {
  return (
    <NotYetBuilt
      title="Reports"
      phase="P5"
      summary="Findings, synthesis and exports — each claim carrying the evidence it rests on."
      delivers={[
        "Findings with confidence, dissent and the evidence drawer behind each one",
        "Unsupported-claim checking before a claim can be exported",
        "Export with the limitations block and simulation disclaimer attached",
      ]}
    />
  );
}
