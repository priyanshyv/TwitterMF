import Link from 'next/link';

export function AuthCard(props: {
  title: string;
  description: string;
  footer: { text: string; linkText: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">
          {props.title}
        </h1>
        <p className="text-muted-foreground">{props.description}</p>
      </div>
      {props.children}
      <p className="text-center text-sm text-muted-foreground">
        {props.footer.text}{' '}
        <Link
          href={props.footer.href}
          className="font-semibold text-sky-500 hover:underline"
        >
          {props.footer.linkText}
        </Link>
      </p>
    </div>
  );
}
