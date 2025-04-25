"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { LoaderCircle, Mic } from "lucide-react";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const AudioRecorder = () => {
	const generate = api.audio.generateAudio.useMutation({});
	const response = api.audio.generateResponse.useMutation({
		onSuccess: (r) => {
			if (r) {
				generate.mutate({ response: r });
			}
		},
		onError: (e) => {
			toast.error("There was an error while generating the response.");
			console.log(e);
		},
	});
	const transcript = api.audio.transcriptAudio.useMutation({
		onSuccess: (t) => {
			if (t) {
				response.mutate({ transcript: t });
			}
		},
		onError: (e) => {
			toast.error("There was an error while generating the transcript.");
			console.log(e);
		},
	});

	const [isRecording, setIsRecording] = useState(false);
	const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
		null,
	);
	const audioChunksRef = useRef<Blob[]>([]);

	const startRecording = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			audioChunksRef.current = [];
			const recorder = new MediaRecorder(stream);

			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					audioChunksRef.current.push(event.data);
				}
			};

			setMediaRecorder(recorder);
			recorder.start();
			setIsRecording(true);
			toast.info("Recording started");
		} catch (error) {
			toast.error("Error accessing microphone");
			console.error("Error accessing microphone:", error);
		}
	};

	const stopRecording = () => {
		if (mediaRecorder && isRecording) {
			mediaRecorder.onstop = () => {
				const audioBlob = new Blob(audioChunksRef.current, {
					type: "audio/webm",
				});
				audioChunksRef.current = [];

				const reader = new FileReader();
				reader.onloadend = () => {
					const base64Audio = reader.result?.toString().split(",")[1];
					if (base64Audio) {
						transcript.mutate({
							base64Audio,
						});

						console.log(transcript.data);
					}
				};
				reader.readAsDataURL(audioBlob);

				const tracks = mediaRecorder.stream.getTracks();
				for (const track of tracks) {
					track.stop();
				}
				setMediaRecorder(null);
			};

			mediaRecorder.stop();
			setIsRecording(false);
			toast.info("Recording stopped");
		}
	};

	return (
		<div className="flex h-screen flex-col items-center justify-center space-y-6">
			<div className="rounded-full bg-black p-4">
				<Mic
					onClick={isRecording ? stopRecording : startRecording}
					className={cn(
						isRecording ? "text-red-500" : "text-white",
						"size-12 cursor-pointer",
					)}
				/>
			</div>
			<div>
				{transcript.isPending ? (
					<div className="flex space-x-2">
						<LoaderCircle className="animate-spin" />
						<p>Transcript is generating...</p>
					</div>
				) : (
					transcript.data?.text
				)}
			</div>
			<div>
				{response.isPending && transcript.isSuccess ? (
					<div className="flex space-x-2">
						<LoaderCircle className="animate-spin" />
						<p>Response is generating...</p>
					</div>
				) : (
					response.data?.text
				)}
			</div>
			{generate.data && (
				// biome-ignore lint/a11y/useMediaCaption: <explanation>
				<audio className="hidden" autoPlay>
					<source src={generate.data} />
				</audio>
			)}
		</div>
	);
};

export default AudioRecorder;
