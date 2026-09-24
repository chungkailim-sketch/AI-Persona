import { NotYetBuilt } from '@/ui/BuildStatus';

export const metadata = { title: 'Methodology · Persona Intelligence' };

export default function Page() {
  return (
    <NotYetBuilt
      title="Methodology"
      phase="P6"
      summary="How the platform produces a finding, what each evidence label means, and what the outputs cannot be used for."
      delivers={[
        "The five evidence levels and how each is assigned",
        "The nine simulation stages and the role of each",
        "Stated limitations, including that persona adherence is not predictive validity",
      ]}
    />
  );
}
