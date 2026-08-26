import { Fragment, useMemo, type MouseEvent } from 'react'

import { cn } from '#/lib/utils'

/**
 * Renders the article with paragraph structure intact and every word
 * tappable, so a learner can look one up at the moment they trip over it.
 *
 * Word taps are handled by delegation from the paragraph rather than by
 * wrapping each word in a button: a 450-word article would otherwise put ~450
 * buttons into the accessibility tree, which makes the passage unreadable with
 * a screen reader for no gain.
 */
export function Reader({
  sentences,
  paragraphStarts,
  targets,
  activeSentence,
  onWordTap,
  onSentenceTap,
}: {
  sentences: string[]
  paragraphStarts: number[]
  targets: string[]
  activeSentence?: number | null
  /** The tapped word, with the index of the sentence it was read in. */
  onWordTap?: (word: string, sentence: number) => void
  onSentenceTap?: (index: number) => void
}) {
  const targetSet = useMemo(
    () => new Set(targets.map((word) => word.toLowerCase())),
    [targets],
  )

  const paragraphs = useMemo(() => {
    const bounds = paragraphStarts.length > 0 ? paragraphStarts : [0]
    return bounds.map((start, index) => {
      const end = bounds[index + 1] ?? sentences.length
      return { start, items: sentences.slice(start, end) }
    })
  }, [sentences, paragraphStarts])

  function handleClick(event: MouseEvent<HTMLParagraphElement>) {
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-w]')
    const sentence = (event.target as HTMLElement).closest<HTMLElement>('[data-s]')
    if (element?.dataset.w) {
      onWordTap?.(element.dataset.w, Number(sentence?.dataset.s ?? -1))
      return
    }
    if (sentence?.dataset.s) onSentenceTap?.(Number(sentence.dataset.s))
  }

  return (
    <div className="reader">
      {paragraphs.map((paragraph) => (
        <p key={paragraph.start} onClick={handleClick}>
          {paragraph.items.map((sentence, offset) => {
            const index = paragraph.start + offset
            return (
              <span
                key={index}
                data-s={index}
                className={cn(
                  'transition-colors',
                  onSentenceTap && 'cursor-pointer',
                  activeSentence === index &&
                    'rounded-md bg-brand-100 shadow-[0_0_0_4px_var(--brand-100)]',
                )}
              >
                <Sentence
                  text={sentence}
                  targetSet={targetSet}
                  interactive={Boolean(onWordTap)}
                />{' '}
              </span>
            )
          })}
        </p>
      ))}
    </div>
  )
}

function Sentence({
  text,
  targetSet,
  interactive,
}: {
  text: string
  targetSet: Set<string>
  interactive: boolean
}) {
  // Keep punctuation and spacing as separate tokens so the prose still reads
  // correctly while each word remains individually addressable.
  const tokens = useMemo(() => text.split(/([A-Za-z][A-Za-z'’-]*)/g), [text])

  return (
    <>
      {tokens.map((token, index) => {
        if (!/^[A-Za-z]/.test(token)) {
          return <Fragment key={index}>{token}</Fragment>
        }
        const clean = token.replace(/[’']s$/i, '').toLowerCase()
        const isTarget = targetSet.has(clean)

        return (
          <span
            key={index}
            data-w={interactive ? clean : undefined}
            className={cn(
              interactive && 'cursor-pointer rounded px-px active:bg-brand-100',
              isTarget &&
                'rounded bg-grass-100 px-0.5 font-semibold text-grass-600',
            )}
          >
            {token}
          </span>
        )
      })}
    </>
  )
}
