'use client';

import { Feather, PenLine } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ComposeBox } from './compose-box';

// Post from anywhere: the compose box in a dialog, so writing a tweet
// doesn't navigate away from the page you're reading.
export function PostButton({
  displayName,
  username,
  floating,
}: {
  displayName: string;
  username: string;
  floating?: boolean; // the round button above the phone tab bar
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="lg"
          aria-label="Post"
          className={cn(
            'rounded-full text-base font-bold',
            floating
              ? 'fixed right-4 bottom-20 z-30 size-14 shadow-lg md:hidden [&_svg]:size-6'
              : 'mt-4 size-12 xl:h-12 xl:w-full',
          )}
        >
          {floating ? (
            <Feather />
          ) : (
            <>
              <PenLine className="xl:hidden" />
              <span className="hidden xl:inline">Post</span>
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="top-[10%] translate-y-0 gap-0 p-0 pt-10 sm:max-w-xl">
        <DialogTitle className="sr-only">New post</DialogTitle>
        <ComposeBox
          id="compose-dialog"
          displayName={displayName}
          username={username}
          autoFocus
          onPosted={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
