//! Offline speech recognition with whisper.cpp, grouped into timed sentences.

use crate::jobs::{is_cancelled, CANCELLED};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub const SAMPLE_RATE: usize = 16_000;
const MAX_SENTENCE_WORDS: usize = 40;
const PAUSE_BREAK_SECONDS: f64 = 1.5;
const TAIL_PADDING_SECONDS: f64 = 0.3;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Sentence {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub words: Vec<Word>,
}

/// A text token from whisper with its time span in seconds.
#[derive(Debug, Clone)]
pub struct Token {
    pub bytes: Vec<u8>,
    pub start: f64,
    pub end: f64,
    pub starts_segment: bool,
}

fn load(model: &Path) -> Result<WhisperContext, String> {
    WhisperContext::new_with_params(model, WhisperContextParameters::default())
        .map_err(|e| format!("模型无法加载（{e}）"))
}

/// Checks that a file is a whisper model that whisper.cpp can load.
pub fn load_test(model: &Path) -> Result<(), String> {
    load(model).map(|_| ())
}

pub fn samples_from_le_bytes(bytes: &[u8]) -> Result<Vec<f32>, String> {
    let (chunks, rest) = bytes.as_chunks::<4>();
    if chunks.is_empty() || !rest.is_empty() {
        return Err("音频数据无效，请重新导入音频。".into());
    }
    Ok(chunks.iter().map(|c| f32::from_le_bytes(*c)).collect())
}

/// Runs whisper on 16 kHz mono samples. Returns only complete results: a cancelled or
/// failed run yields an error and no sentences.
pub fn transcribe(
    model: &Path,
    samples: &[f32],
    cancel: Arc<AtomicBool>,
    progress: impl FnMut(i32) + 'static,
) -> Result<Vec<Sentence>, String> {
    let context = load(model)?;
    let mut state = context
        .create_state()
        .map_err(|e| format!("识别初始化失败（{e}）"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_token_timestamps(true);
    params.set_suppress_nst(true);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    params.set_n_threads(thread_count());
    params.set_progress_callback_safe(progress);
    let abort = cancel.clone();
    // whisper-rs casts user data to `F`, so `F` must be the boxed trait object it stores.
    params.set_abort_callback_safe::<_, Box<dyn FnMut() -> bool>>(Box::new(move || {
        is_cancelled(&abort)
    })
        as Box<dyn FnMut() -> bool>);

    let result = state.full(params, samples);
    if is_cancelled(&cancel) {
        return Err(CANCELLED.into());
    }
    result.map_err(|e| format!("识别失败（{e}）"))?;

    let end_of_text = context.token_eot();
    let mut tokens = Vec::new();
    for segment in state.as_iter() {
        for index in 0..segment.n_tokens() {
            let Some(token) = segment.get_token(index) else {
                continue;
            };
            if token.token_id() >= end_of_text {
                continue;
            }
            let data = token.token_data();
            tokens.push(Token {
                bytes: token.to_bytes().map(<[u8]>::to_vec).unwrap_or_default(),
                start: data.t0 as f64 / 100.0,
                end: data.t1 as f64 / 100.0,
                starts_segment: index == 0,
            });
        }
    }
    let duration = samples.len() as f64 / SAMPLE_RATE as f64;
    Ok(group_sentences(merge_words(&tokens), duration))
}

fn thread_count() -> i32 {
    std::thread::available_parallelism().map_or(4, |n| n.get().min(8) as i32)
}

/// Joins sub-word tokens into words. A token starting with a space opens a new word.
pub fn merge_words(tokens: &[Token]) -> Vec<Word> {
    let mut words: Vec<(Vec<u8>, f64, f64)> = Vec::new();
    for token in tokens {
        let opens_word = token.starts_segment || token.bytes.first() == Some(&b' ');
        match words.last_mut() {
            Some(current) if !opens_word => {
                current.0.extend_from_slice(&token.bytes);
                current.2 = current.2.max(token.end);
            }
            _ => words.push((token.bytes.clone(), token.start, token.end.max(token.start))),
        }
    }
    words
        .into_iter()
        .map(|(bytes, start, end)| Word {
            text: String::from_utf8_lossy(&bytes).trim().to_string(),
            start,
            end,
        })
        .filter(|w| !w.text.is_empty() && !is_annotation(&w.text))
        .collect()
}

/// Non-speech markers such as `[BLANK_AUDIO]` or `[Music]`.
fn is_annotation(text: &str) -> bool {
    text.starts_with('[') && text.ends_with(']')
}

fn ends_sentence(text: &str) -> bool {
    text.trim_end_matches(['"', '\'', ')', '”', '’'])
        .ends_with(['.', '?', '!'])
}

/// Groups words into sentences at end punctuation, long pauses or a length limit, then
/// makes sentence spans ordered and non-overlapping within `duration`.
pub fn group_sentences(words: Vec<Word>, duration: f64) -> Vec<Sentence> {
    let mut groups: Vec<Vec<Word>> = Vec::new();
    for word in words {
        let starts_new = match groups.last().and_then(|g| g.last()) {
            None => true,
            Some(previous) => {
                ends_sentence(&previous.text)
                    || word.start - previous.end > PAUSE_BREAK_SECONDS
                    || groups.last().map_or(0, Vec::len) >= MAX_SENTENCE_WORDS
            }
        };
        if starts_new {
            groups.push(vec![word]);
        } else if let Some(group) = groups.last_mut() {
            group.push(word);
        }
    }
    let mut sentences: Vec<Sentence> = groups
        .into_iter()
        .map(|words| Sentence {
            text: words
                .iter()
                .map(|w| w.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
            start: words[0].start,
            end: words[words.len() - 1].end,
            words,
        })
        .collect();
    fit_spans(&mut sentences, duration);
    sentences
}

/// Pads each sentence end into the following gap so the last word is not clipped, and
/// keeps spans ordered, non-overlapping and inside the audio.
fn fit_spans(sentences: &mut [Sentence], duration: f64) {
    let mut previous_end = 0.0_f64;
    for index in 0..sentences.len() {
        let next_start = sentences.get(index + 1).map_or(duration, |s| s.start);
        let sentence = &mut sentences[index];
        sentence.start = sentence.start.max(previous_end).min(duration);
        let padded = (sentence.end + TAIL_PADDING_SECONDS).min(next_start.max(sentence.end));
        sentence.end = padded
            .min(duration)
            .max(sentence.start + 0.01)
            .min(duration);
        previous_end = sentence.end;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(text: &str, start: f64, end: f64) -> Token {
        Token {
            bytes: text.as_bytes().to_vec(),
            start,
            end,
            starts_segment: false,
        }
    }

    fn word(text: &str, start: f64, end: f64) -> Word {
        Word {
            text: text.into(),
            start,
            end,
        }
    }

    #[test]
    fn merges_sub_word_tokens_and_drops_markers() {
        let mut first = token("Hel", 0.0, 0.2);
        first.starts_segment = true;
        let tokens = [
            first,
            token("lo", 0.2, 0.4),
            token(",", 0.4, 0.45),
            token(" world", 0.5, 0.9),
            token(".", 0.9, 0.95),
            token(" [", 1.0, 1.1),
            token("BLANK_AUDIO", 1.1, 1.5),
            token("]", 1.5, 1.6),
        ];
        assert_eq!(
            merge_words(&tokens),
            vec![word("Hello,", 0.0, 0.45), word("world.", 0.5, 0.95)]
        );
    }

    #[test]
    fn splits_sentences_at_punctuation_and_long_pauses() {
        let words = vec![
            word("Hello", 0.0, 0.4),
            word("there.", 0.5, 0.9),
            word("How", 1.0, 1.2),
            word("are", 1.3, 1.4),
            word("you?", 1.5, 1.8),
            word("Fine", 4.0, 4.3),
            word("thanks", 4.4, 4.8),
        ];
        let sentences = group_sentences(words, 10.0);
        let texts: Vec<_> = sentences.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, ["Hello there.", "How are you?", "Fine thanks"]);
        assert_eq!(sentences[0].start, 0.0);
        assert_eq!(sentences[0].end, 1.0, "padding stops at the next sentence");
        assert!((sentences[1].end - 2.1).abs() < 1e-9);
        assert!((sentences[2].end - 5.1).abs() < 1e-9);
        assert_eq!(sentences[1].words.len(), 3);
    }

    #[test]
    fn keeps_spans_ordered_and_inside_the_audio() {
        let words = vec![
            word("One.", 0.0, 1.2),
            word("Two.", 1.0, 2.0),
            word("Three.", 2.9, 3.4),
        ];
        let sentences = group_sentences(words, 3.2);
        for pair in sentences.windows(2) {
            assert!(pair[0].end <= pair[1].start);
        }
        for sentence in &sentences {
            assert!(sentence.start < sentence.end && sentence.end <= 3.2);
        }
    }

    #[test]
    fn caps_sentence_length() {
        let words = (0..90)
            .map(|i| word("go", i as f64 * 0.2, i as f64 * 0.2 + 0.1))
            .collect();
        let lengths: Vec<_> = group_sentences(words, 20.0)
            .iter()
            .map(|s| s.words.len())
            .collect();
        assert_eq!(lengths, [40, 40, 10]);
    }

    #[test]
    fn decodes_little_endian_samples() {
        let bytes: Vec<u8> = [0.5f32, -1.0]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        assert_eq!(samples_from_le_bytes(&bytes).unwrap(), vec![0.5, -1.0]);
        assert!(samples_from_le_bytes(&[1, 2, 3]).is_err());
    }

    /// Reads 16-bit PCM mono 16 kHz WAV data.
    fn read_wav(path: &str) -> Vec<f32> {
        let bytes = std::fs::read(path).unwrap();
        let data = bytes.windows(4).position(|w| w == b"data").unwrap() + 8;
        let (samples, _) = bytes[data..].as_chunks::<2>();
        samples
            .iter()
            .map(|c| i16::from_le_bytes(*c) as f32 / 32768.0)
            .collect()
    }

    /// Real recognition: `ATTUNE_TEST_MODEL=... ATTUNE_TEST_WAV=... cargo test -- --ignored real`.
    #[test]
    #[ignore]
    fn real_transcription_of_a_clip() {
        let model = std::env::var("ATTUNE_TEST_MODEL").unwrap();
        let samples = read_wav(&std::env::var("ATTUNE_TEST_WAV").unwrap());
        let started = std::time::Instant::now();
        let sentences = transcribe(
            Path::new(&model),
            &samples,
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .unwrap();
        println!(
            "audio {:.1}s, recognized in {:.1}s",
            samples.len() as f64 / SAMPLE_RATE as f64,
            started.elapsed().as_secs_f64()
        );
        for s in &sentences {
            println!(
                "{:.2}-{:.2} [{} words] {}",
                s.start,
                s.end,
                s.words.len(),
                s.text
            );
        }
        assert!(!sentences.is_empty());
    }

    #[test]
    #[ignore]
    fn real_transcription_can_be_cancelled() {
        let model = std::env::var("ATTUNE_TEST_MODEL").unwrap();
        let samples = read_wav(&std::env::var("ATTUNE_TEST_WAV").unwrap());
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let started = std::time::Instant::now();
        let result = transcribe(Path::new(&model), &samples, cancel, move |percent| {
            if percent > 0 {
                flag.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        });
        println!("stopped after {:.1}s", started.elapsed().as_secs_f64());
        assert_eq!(result.unwrap_err(), CANCELLED);
    }
}
