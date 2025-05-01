import { Toaster } from "sonner";
import AudioRecorder from "~/components/recorder";

export default async function Home() {
	return (
		<div>
			<Toaster richColors />
			<AudioRecorder />
		</div>
	);
}
