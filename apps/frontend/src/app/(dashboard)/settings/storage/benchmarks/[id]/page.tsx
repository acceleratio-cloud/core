import { BenchmarkReportView } from '@/modules/settings/containers/benchmark-report-view';

export default async function BenchmarkReportPage({
  params,
}: PageProps<'/settings/storage/benchmarks/[id]'>) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <BenchmarkReportView id={id} />
    </div>
  );
}
