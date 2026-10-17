import { Module } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { OutboxRelay } from '../jobs/outbox.relay.js';
import { MediaModule } from '../media/media.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TimelineModule } from '../timeline/timeline.module.js';
import { WorkerService } from './worker.service.js';

// Everything the API has, plus the queue consumers. The worker process boots
// this without an HTTP server; e2e tests boot it with one, so jobs run in
// the same process and tests can wait for them.
@Module({
  imports: [AppModule, TimelineModule, NotificationsModule, MediaModule],
  providers: [WorkerService, OutboxRelay],
})
export class WorkerModule {}
