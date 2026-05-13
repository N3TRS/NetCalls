import { IsString, IsArray, ArrayMinSize, IsNotEmpty } from 'class-validator';

export class CreateCallDto {
  @IsString()
  @IsNotEmpty()
  callerId: string;

  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one participant is required' })
  @IsString({ each: true })
  participants: string[];
}
