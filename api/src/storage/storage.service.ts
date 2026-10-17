import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { BreakersService } from '../breakers/breakers.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

// Object storage: files (images) live here, not in Postgres. Databases are
// built for small rows; a 3 MB photo per tweet would bloat backups, crowd
// out the cache and make every query on that table slower. Object stores
// are cheap per GB, serve files straight to browsers or a CDN, and scale
// without us doing anything.
//
// Layout in the bucket:
//   uploads/<mediaId>          raw upload, private, deleted once processed
//   media/<mediaId>/large.webp processed, public (served to everyone)
//   media/<mediaId>/small.webp

const UPLOAD_URL_TTL_SECONDS = 5 * 60;

@Injectable()
export class StorageService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Storage');
  private readonly s3: S3Client;
  // Same credentials, but signs URLs for the host browsers can reach. The
  // signature covers the host, so a URL signed for "storage:9000" inside
  // Docker would be useless to a browser.
  private readonly signer: S3Client;
  readonly bucket: string;
  private readonly mediaBaseUrl: string;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(BreakersService) private readonly breakers: BreakersService,
  ) {
    const client = (endpoint: string) =>
      new S3Client({
        endpoint,
        region: env.STORAGE_REGION,
        forcePathStyle: true, // bucket in the path, not a subdomain
        credentials: {
          accessKeyId: env.STORAGE_ACCESS_KEY,
          secretAccessKey: env.STORAGE_SECRET_KEY,
        },
      });
    this.s3 = client(env.STORAGE_ENDPOINT);
    this.signer = client(env.STORAGE_PUBLIC_ENDPOINT);
    this.bucket = env.STORAGE_BUCKET;
    this.mediaBaseUrl =
      env.MEDIA_BASE_URL ??
      `${env.STORAGE_PUBLIC_ENDPOINT.replace(/\/$/, '')}/${this.bucket}`;
  }

  // Creates the bucket on first boot: public read for media/* only, and
  // CORS so the web app may PUT uploads into it from the browser.
  async onApplicationBootstrap() {
    try {
      await this.ensureBucket();
    } catch (err) {
      // Uploads fail until storage is back; everything else keeps working.
      this.logger.warn(
        `bucket setup skipped, storage unavailable: ${String(err)}`,
      );
    }
  }

  async ensureBucket() {
    const exists = await this.s3
      .send(new HeadBucketCommand({ Bucket: this.bucket }))
      .then(() => true)
      .catch(() => false);
    if (!exists)
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    await this.s3.send(
      new PutBucketPolicyCommand({
        Bucket: this.bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/media/*`],
            },
          ],
        }),
      }),
    );
    await this.s3.send(
      new PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: this.env.CORS_ORIGIN.split(','),
              AllowedMethods: ['PUT', 'GET'],
              AllowedHeaders: ['*'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  }

  // A presigned URL: permission to do exactly one thing (PUT this key, with
  // this content type and size) for the next 5 minutes, signed with our
  // secret but without revealing it. The browser uploads straight to
  // storage, so a 5 MB photo never passes through our API servers.
  presignUpload(
    key: string,
    contentType: string,
    bytes: number,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: bytes,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
  }

  // Size and type of an object, or null if it isn't there. Behind the
  // storage circuit breaker: called inside requests.
  head(key: string): Promise<{ bytes: number; contentType: string } | null> {
    return this.breakers.run('storage', async () => {
      try {
        const res = await this.s3.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        return {
          bytes: res.ContentLength ?? 0,
          contentType: res.ContentType ?? '',
        };
      } catch (err) {
        if ((err as { name?: string }).name === 'NotFound') return null;
        throw err;
      }
    });
  }

  // The rest is used by the worker, which retries on its own.
  async get(key: string): Promise<Buffer> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Processed images never change (a new upload gets a new ID), so
        // browsers and CDNs may cache them forever.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  publicUrl(key: string): string {
    return `${this.mediaBaseUrl}/${key}`;
  }

  async ping(): Promise<boolean> {
    return this.s3
      .send(new HeadBucketCommand({ Bucket: this.bucket }))
      .then(() => true)
      .catch(() => false);
  }
}
