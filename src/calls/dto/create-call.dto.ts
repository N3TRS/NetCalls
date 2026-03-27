import { IsString } from 'class-validator';

export class CreateCallDto {
  @IsString()
  callerId: string;
  participants: string[];
}
