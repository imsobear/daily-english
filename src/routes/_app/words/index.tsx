import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { PageHeader } from '#/components/bottom-nav'
import { ButtonLink, EmptyState } from '#/components/ui'
import { listWords } from '#/server/words'

export const Route = createFileRoute('/_app/words/')({
  loader: () => listWords(),
  component: WordsPage,
})

/** Four buckets so the list reads as progress rather than a flat dump. */
function strengthOf(familiarity: number) {
  if (familiarity >= 0.8) return { label: 'Strong', bars: 3, tone: 'grass' }
  if (familiarity >= 0.4) return { label: 'Getting there', bars: 2, tone: 'brand' }
  if (familiarity > 0) return { label: 'Shaky', bars: 1, tone: 'brand' }
  return { label: 'New', bars: 0, tone: 'neutral' }
}

function StrengthBars({ bars, tone }: { bars: number; tone: string }) {
  const color =
    tone === 'grass'
      ? 'bg-grass-500'
      : tone === 'brand'
        ? 'bg-brand-500'
        : 'bg-hairline-strong'
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`w-1 rounded-full ${index < bars ? color : 'bg-hairline-strong'}`}
          style={{ height: 6 + index * 3 }}
        />
      ))}
    </span>
  )
}

function WordsPage() {
  const words = Route.useLoaderData()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return words
    return words.filter(
      (word) =>
        word.headword.toLowerCase().includes(needle) ||
        (word.ipa ?? '').toLowerCase().includes(needle),
    )
  }, [words, query])

  return (
    <>
      <PageHeader
        title="Words"
        description={
          words.length > 0
            ? `${words.length} saved · each lesson pulls from here`
            : 'Your collection feeds every lesson'
        }
      />

      <main className="p-3.5 pb-8">
        <ButtonLink to="/words/add" block size="lg" className="mb-3">
          <Plus className="size-5" />
          Add words
        </ButtonLink>

        {words.length > 4 ? (
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your list"
              autoCapitalize="none"
              autoCorrect="off"
              className="min-h-11 w-full rounded-2xl border border-hairline-strong bg-surface pl-10 pr-3 text-base font-semibold"
            />
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <EmptyState
            title={words.length === 0 ? 'No words yet' : 'Nothing matches'}
            body={
              words.length === 0
                ? 'Tap Add words to type one in or pick from recommendations.'
                : 'Try a different search.'
            }
          />
        ) : (
          // Two across: a headword and its IPA are narrow, and the list is for
          // scanning. Removing a word lives on the word's own page.
          <ul className="grid grid-cols-2 gap-2">
            {filtered.map((word) => {
              const strength = strengthOf(word.familiarity)
              return (
                <li key={word.id}>
                  <Link
                    to="/words/$wordId"
                    params={{ wordId: word.id }}
                    className="card-soft flex min-h-14 flex-col justify-center gap-0.5 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <StrengthBars bars={strength.bars} tone={strength.tone} />
                      <span className="truncate font-extrabold">
                        {word.headword}
                      </span>
                    </span>
                    <span className="truncate text-xs text-ink-soft">
                      {word.ipa ??
                        (word.dictionaryMiss ? 'No definition' : strength.label)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </>
  )
}
