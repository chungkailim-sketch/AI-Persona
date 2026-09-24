import { NotYetBuilt } from '@/ui/BuildStatus';

export const metadata = { title: 'Datasets · Persona Intelligence' };

export default function Page() {
  return (
    <NotYetBuilt
      title="Datasets"
      phase="P3"
      summary="Dataset library: uploaded sources, their versions, field classification and governance state."
      delivers={[
        "Upload CSV and XLSX sources with server-side parsing of untrusted content",
        "Immutable dataset versions with a content hash per version",
        "Field-level sensitivity classification and exclusion",
        "Governance record capturing consent basis and processing permission",
        "Automated integrity findings surfaced before the data can be used",
      ]}
    />
  );
}
