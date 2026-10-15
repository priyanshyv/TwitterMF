import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function AuthCard(props: {
  title: string;
  description: string;
  footer: { text: string; linkText: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex max-w-sm flex-col px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{props.title}</CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
        <CardContent>{props.children}</CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          {props.footer.text}&nbsp;
          <Link
            href={props.footer.href}
            className="font-medium text-foreground hover:underline"
          >
            {props.footer.linkText}
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
