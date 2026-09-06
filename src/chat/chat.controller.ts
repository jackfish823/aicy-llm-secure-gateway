import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { chatRequestSchema, type ChatRequest, type ChatResponse } from './chat.schemas.js';
import { ChatService } from './chat.service.js';

@Controller('v1/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** Body validated by the global StandardSchemaValidationPipe against chatRequestSchema. */
  @Post()
  @HttpCode(HttpStatus.OK)
  chat(@Body({ schema: chatRequestSchema }) request: ChatRequest): Promise<ChatResponse> {
    return this.chatService.chat(request);
  }
}
