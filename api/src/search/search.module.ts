import { Module } from '@nestjs/common';
import { TweetsModule } from '../tweets/tweets.module.js';
import { UserRecordsModule } from '../users/user-records.module.js';
import { SearchController } from './search.controller.js';
import { SearchProcessor } from './search.processor.js';
import { SearchService } from './search.service.js';
import { TrendsService } from './trends.service.js';

@Module({
  imports: [TweetsModule, UserRecordsModule],
  controllers: [SearchController],
  providers: [SearchService, TrendsService, SearchProcessor],
  exports: [SearchService, TrendsService, SearchProcessor],
})
export class SearchModule {}
