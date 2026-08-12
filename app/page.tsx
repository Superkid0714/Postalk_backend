export default function Home() {
  return (
    <main className="min-h-screen bg-stone-950 px-6 py-16 text-stone-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <div className="space-y-4">
          <span className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1 text-sm text-emerald-200">
            POSTALK Server
          </span>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            24시간 운영을 위한 POSTALK 백엔드 베이스가 준비되었습니다.
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-stone-300">
            현재 프로젝트는 Next.js 기반으로 구성되어 있으며, 운영 환경에서는
            Docker와 재시작 정책을 이용해 항상 살아있는 서버로 배포할 수
            있습니다.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold text-white">API 서버</h2>
            <p className="mt-3 text-sm leading-7 text-stone-300">
              Next.js App Router 기반 API 엔드포인트를 배포합니다.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold text-white">상태 확인</h2>
            <p className="mt-3 text-sm leading-7 text-stone-300">
              <code>/api/health</code> 엔드포인트로 서버 상태를 점검할 수
              있습니다.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold text-white">상시 운영</h2>
            <p className="mt-3 text-sm leading-7 text-stone-300">
              Docker Compose의 <code>restart: unless-stopped</code> 설정으로
              재부팅 후 자동 복구가 가능합니다.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-6">
          <h2 className="text-xl font-semibold text-white">다음 권장 순서</h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-stone-200">
            <li>Supabase 프로젝트 생성 및 환경 변수 설정</li>
            <li>업로드, 관리자 검수, 인사이트 API 구현</li>
            <li>STT/LLM 작업을 별도 워커로 분리</li>
            <li>VPS 또는 클라우드에 Docker Compose로 배포</li>
          </ol>
        </section>
      </div>
    </main>
  );
}
