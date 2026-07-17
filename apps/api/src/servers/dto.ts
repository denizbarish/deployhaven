import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateServerDto {
  @IsString() name!: string;
  @IsString() host!: string;
  @IsOptional() @IsString() sshUser?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) sshPort?: number;
  @IsString() sshPrivateKey!: string;
}
