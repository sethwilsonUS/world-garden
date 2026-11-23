import { HomeListeningSample } from "@/components/HomeListeningSample";

const steps = [
  {
    title: "Find a topic",
    body: "Search any Wikipedia article, or press Surprise me for something new.",
  },
  {
    title: "Choose what to hear",
    body: "Play the whole article, or jump straight to the sections you care about. Headings, links, and sources stay intact.",
  },
  {
    title: "Keep listening",
    body: "Your place is saved. Keep articles in your Library, or follow the daily podcasts in any podcast app.",
  },
];

export const HomeHowItWorks = () => (
  <section
    id="how-it-works"
    aria-labelledby="how-it-works-heading"
    className="mt-16 rounded-3xl border border-border bg-surface-2 p-5 [overflow-wrap:anywhere] sm:p-8 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)] lg:items-start lg:gap-10"
  >
    <div className="min-w-0">
      <h2
        id="how-it-works-heading"
        className="type-section-title font-display font-semibold text-foreground"
      >
        New here? How Curio Garden works
      </h2>
      <ol className="m-0 mt-5 list-none space-y-4 p-0">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-bg font-semibold text-accent"
            >
              {index + 1}
            </span>
            <p className="m-0 min-w-0 text-base leading-[1.6] text-foreground-2">
              <strong className="font-semibold text-foreground">
                {step.title}.
              </strong>{" "}
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </div>
    <div className="mt-6 min-w-0 lg:mt-0">
      <HomeListeningSample />
    </div>
  </section>
);
