import { NotYetBuilt } from '@/ui/BuildStatus';

export const metadata = { title: 'Presets · Persona Intelligence' };

export default function Page() {
  return (
    <NotYetBuilt
      title="Presets"
      phase="P5"
      summary="Saved run configurations, persona templates and prompt templates."
      delivers={[
        "Reusable run presets with their parameters recorded",
        "Persona and prompt templates under versioned management",
      ]}
    />
  );
}
