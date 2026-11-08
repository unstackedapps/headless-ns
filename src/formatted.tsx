import { inlineSpans, markdownBlocks, type Span } from "./markdown";

function spans(text: string) {
  return inlineSpans(text).map((span, index) => <SpanView key={index} span={span} />);
}

function SpanView({ span }: { span: Span }) {
  if (span.kind === "code") return <code>{span.text}</code>;
  if (span.kind === "strong") return <strong>{span.text}</strong>;
  if (span.kind === "em") return <em>{span.text}</em>;
  if (span.kind === "link" && span.href) {
    return (
      <a href={span.href} target="_blank" rel="noreferrer">
        {span.text}
      </a>
    );
  }
  return span.text;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {markdownBlocks(text).map((block, index) => {
        if (block.type === "h") return <h3 key={index}>{spans(block.text)}</h3>;
        if (block.type === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{spans(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{spans(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.type === "pre") return <pre key={index}>{block.text}</pre>;
        return <p key={index}>{spans(block.text)}</p>;
      })}
    </div>
  );
}
