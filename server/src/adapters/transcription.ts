import { TranscriptionProvider } from '../types';

/**
 * LocalStubTranscriptionProvider returns realistic PT SOAP note text.
 * Replace with AWSTranscribeMedicalProvider for production cloud-based transcription.
 */
export class LocalStubTranscriptionProvider implements TranscriptionProvider {
  private sampleTexts = [
    `Patient reports improvement in right shoulder range of motion since last visit. Pain level decreased from 6/10 to 4/10 with overhead activities. States sleeping better, only waking once at night due to discomfort. Denies any new symptoms or concerns. Continues home exercise program as instructed, performing exercises twice daily.`,
    `Patient presents today for follow-up of left knee post-operative rehabilitation, status post ACL reconstruction 6 weeks ago. Reports compliance with home exercise program. States able to walk without assistive device for short distances. Pain rated 3/10 at rest, 5/10 with activity. Mild swelling noted at end of day.`,
    `Patient reports persistent low back pain radiating to left lower extremity. Symptoms worsen with prolonged sitting greater than 30 minutes. Pain level 5/10 at baseline, increases to 7/10 with aggravating activities. Reports difficulty with work tasks requiring bending and lifting. Sleep disrupted 2-3 times per night.`,
    `Patient demonstrates improved functional mobility following right total hip arthroplasty 4 weeks ago. Able to ambulate 500 feet with single point cane. Stairs managed with rail, step-over-step pattern. Reports independence with bathing and dressing with use of adaptive equipment. Pain well controlled at 2/10.`,
    `Patient reports gradual onset of neck pain and bilateral upper extremity tingling over the past 2 weeks. Symptoms exacerbated by computer work and driving. Pain rated 4/10 currently. Headaches occurring 3-4 times per week, originating from base of skull. Denies dizziness or difficulty swallowing.`,
  ];

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<{ text: string; confidence: number }> {
    // Simulate processing time based on buffer size
    const processingMs = Math.min(2000, Math.max(500, audioBuffer.length / 1000));
    await new Promise(resolve => setTimeout(resolve, processingMs));

    const text = this.sampleTexts[Math.floor(Math.random() * this.sampleTexts.length)];

    return {
      text,
      confidence: 0.92 + Math.random() * 0.07, // 0.92-0.99
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

/**
 * Production implementation guide:
 *
 * export class AWSTranscribeMedicalProvider implements TranscriptionProvider {
 *   constructor(private config: { region: string; accessKeyId: string; secretAccessKey: string }) {}
 *
 *   async transcribe(audioBuffer: Buffer, mimeType: string) {
 *     // Use @aws-sdk/client-transcribe
 *     // 1. Upload audio to S3 (use presigned URL)
 *     // 2. Start medical transcription job
 *     // 3. Poll for completion
 *     // 4. Return transcript
 *     // IMPORTANT: Ensure BAA is in place with AWS
 *   }
 *
 *   async isAvailable() {
 *     // Check AWS credentials and service health
 *   }
 * }
 */
