import { NotYetBuilt } from '@/ui/BuildStatus';

export const metadata = { title: 'Personas · Persona Intelligence' };

export default function Page() {
  return (
    <NotYetBuilt
      title="Personas"
      phase="P4"
      summary="Persona library: generated cohorts, their versions, and the evidence behind every attribute."
      delivers={[
        "Cohort generation from an approved dataset version",
        "Attribute-level provenance: observed, derived, inferred or simulated",
        "Version history with approval state; approved versions are immutable",
      ]}
    />
  );
}
