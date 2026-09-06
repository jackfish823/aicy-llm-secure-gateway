import { Module, type Type } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { GatewayPipeline } from './gateway-pipeline.js';
import { INBOUND_STAGES, OUTBOUND_STAGES, type InboundStage, type OutboundStage } from './stage.js';

/**
 * The only place stage order is defined. To add a security layer: implement InboundStage or
 * OutboundStage as an @Injectable class and append it here.
 */
export const INBOUND_STAGE_ORDER: Type<InboundStage>[] = [];
export const OUTBOUND_STAGE_ORDER: Type<OutboundStage>[] = [];

@Module({
  imports: [ProvidersModule],
  providers: [
    ...INBOUND_STAGE_ORDER,
    ...OUTBOUND_STAGE_ORDER,
    {
      provide: INBOUND_STAGES,
      useFactory: (...stages: InboundStage[]): readonly InboundStage[] => Object.freeze(stages),
      inject: INBOUND_STAGE_ORDER,
    },
    {
      provide: OUTBOUND_STAGES,
      useFactory: (...stages: OutboundStage[]): readonly OutboundStage[] => Object.freeze(stages),
      inject: OUTBOUND_STAGE_ORDER,
    },
    GatewayPipeline,
  ],
  exports: [GatewayPipeline],
})
export class PipelineModule {}
