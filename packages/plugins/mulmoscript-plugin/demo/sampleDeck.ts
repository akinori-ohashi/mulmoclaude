// An all-slide MulmoScript, which is the condition that makes the View mount the deck editor
// (`hasEditableBeats`). Layouts are chosen for what the demo has to show: `grid` and `columns`
// carry reorderable list items, `bigQuote` was the layout whose marker used to swallow its own
// quotation marks, and `title` is the plain case.

export const sampleDeck = {
  title: "Beat editor demo",
  lang: "en",
  presentationStyle: { slideParams: { theme: { name: "default" } } },
  beats: [
    {
      text: "Opening",
      image: { type: "slide", slide: { layout: "title", title: "Beat editor demo", subtitle: "mounted the way the plugin mounts it" } },
    },
    {
      text: "Three things",
      image: {
        type: "slide",
        slide: {
          layout: "grid",
          title: "What to look at",
          items: [
            { title: "Layout", description: "does the pane sit beside the list, or under it" },
            { title: "Slide styling", description: "do the slides themselves have their theme" },
            { title: "Reorder", description: "drag one of these cards onto another" },
          ],
        },
      },
    },
    {
      text: "Two columns",
      image: {
        type: "slide",
        slide: {
          layout: "columns",
          title: "Columns",
          columns: [
            { title: "Left", content: [{ type: "bullets", items: ["first", "second"] }] },
            { title: "Right", content: [{ type: "bullets", items: ["third", "fourth"] }] },
          ],
        },
      },
    },
    {
      text: "Closing",
      image: { type: "slide", slide: { layout: "bigQuote", quote: "Design is not just what it looks like", author: "Steve Jobs" } },
    },
    // A non-slide beat: the editor used to refuse a script containing one, so the whole thing
    // fell through to a read-only list. Kept here so the demo covers the mixed case.
    {
      text: "And a markdown beat",
      image: { type: "markdown", markdown: "## Markdown too\n\n- edited in place\n- not just decks" },
    },
  ],
};
