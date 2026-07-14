import { ArrowRight, Github, Wrench } from 'lucide-react'

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-indigo-500 p-2 text-white shadow-lg shadow-indigo-950/40">
              <Wrench size={20} />
            </span>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black tracking-wide">独立工具模板</h1>
              <span className="rounded-full border border-indigo-400/40 bg-indigo-400/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide text-indigo-200">
                v{import.meta.env.APP_VERSION}
              </span>
            </div>
          </div>
          <a
            href="https://github.com/loogg/tool-template"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            aria-label="GitHub repository"
          >
            <Github size={20} />
          </a>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col items-start px-6 py-24">
        <span className="mb-5 rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">
          React + Vite + GitHub Pages
        </span>
        <h2 className="max-w-3xl text-4xl font-black leading-tight sm:text-6xl">
          从这里开始构建一个独立发布的工具
        </h2>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-400">
          替换项目名称和页面内容，设置初始版本，然后通过语义化版本标签发布。每个工具拥有自己的仓库、版本和 Pages 站点。
        </p>
        <a
          href="https://github.com/loogg/tool-template/generate"
          className="mt-10 inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-950/40 transition hover:bg-indigo-400"
        >
          使用此模板
          <ArrowRight size={17} />
        </a>
      </main>
    </div>
  )
}
