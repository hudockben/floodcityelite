export default function Placeholder({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="empty">
        <div className="empty-icon" aria-hidden="true">
          {icon}
        </div>
        <p className="empty-title">Nothing here yet</p>
        <p className="empty-sub">This section is set up and ready to build out.</p>
      </div>
    </section>
  );
}
