import { IsString } from 'class-validator';

export class CallActionDto {
  @IsString()
  userId: string;
}
