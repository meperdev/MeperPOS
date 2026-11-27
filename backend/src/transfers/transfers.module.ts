import { Module } from '@nestjs/common';
import { SequenceModule } from '../common/sequences/sequence.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [SequenceModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
