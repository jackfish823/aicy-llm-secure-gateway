import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '../common/context/request-context.service.js';
import { GatewayPipeline } from '../pipeline/gateway-pipeline.js';
import { RequestBlockedException } from './chat.exceptions.js';
import { chatResponseSchema, type ChatRequest, type ChatResponse } from './chat.schemas.js';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly pipeline: GatewayPipeline,
    private readonly contextService: RequestContextService,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const context = this.contextService.get();
    const { requestId } = context;
    const result = await this.pipeline.run(request);

    if (result.kind === 'blocked') {
      throw new RequestBlockedException(result.phase, result.stage, result.reason, requestId);
    }

    const { response } = result;

    const body = chatResponseSchema.parse({
      requestId,
      content: response.content,
      model: response.model,
      stopReason: response.stopReason,
      usage: response.usage,
    });

    const exec = context.exec;
    const execSummary =
      exec === undefined ? '' : ` provider=${exec.provider} latencyMs=${exec.latencyMs}`;

    this.logger.log(
      `completed [${requestId}]${execSummary} model=${body.model} in=${body.usage.inputTokens} out=${body.usage.outputTokens}`,
    );

    return body;
  }
}
