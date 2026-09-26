/**
 * Page section shell — mono section index, serif title, one-line gray deck.
 */
export default function Section({ id, index, label, title, deck, children }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line py-20 sm:py-24">
      <div className="grid items-end gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="kicker">
            {index} <span className="text-ink-3/60">—</span> {label}
          </p>
          <h2 className="display mt-5 text-[2.25rem] leading-[1.05] sm:text-[2.75rem]">
            {title}
          </h2>
        </div>
        <div className="lg:col-span-5 lg:pb-2">
          <p className="max-w-[54ch] text-[15px] leading-relaxed text-ink-2">{deck}</p>
        </div>
      </div>
      <div className="mt-10 sm:mt-12">{children}</div>
    </section>
  );
}
