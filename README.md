# SwiftGuardian

## Watch the video:

[![](https://img.youtube.com/vi/i4FAZyYRes8/maxresdefault.jpg)](https://youtu.be/i4FAZyYRes8)

The GitHub version does not contain API keys and configuration to work out of the box. For a preconfigured version, please download from https://swiftguardian.theoleecj.net/dl/13aef2.zip.

## Inspiration

Fake news, harmful viral trends, online scams and data leakage through LLMs are major challenges facing both individuals and enterprises today. The advent of **powerful in-browser, on-device AI presents an opportunity to flip the script**: instead of being the delivery mode for online threats, the web browser can become a powerful line of defense, preventing these threats from reaching users in the first place by acting as a privacy-respecting personal sentinel.

## What it does

As an extension of your favourite Chrome browser, SwiftGuardian is well-placed to protect users from online harms such as:

1. **Fake news** - SwiftGuardian checks headlines against Google's Fact Check API to verify their accuracy and displays links to relevant resources debunking or clarifying misleading headlines.

2. **Online scams** - SwiftGuardian's classifier-detector pipeline allows it to detect a plethora of online scams, ranging from investment scams to sneaky ecommerce scams like storage capacity fraud, with a low false positive rate. ![](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/927/615/datas/gallery.jpg)

3. **Harmful viral trends** - the worst kinds of trends tend to go viral for all the wrong reasons, such as the Cinnamon Challenge and Tide Pod Challenge. SwiftGuardian Family Center watches kids' browsing to detect mentions of such harmful trends and delivers a privacy-preserving, focused report to their guardian, allowing for meaningful, mature discussion.

4. **Enterprise data leakage** - by some accounts, [**up to 77% of employees may be sharing company secrets with chatbots like ChatGPT 😱**](https://www.peoplematters.in/news/ai-and-emerging-tech/77percent-of-employees-share-company-secrets-on-chatgpt-report-46778). SwiftGuardian PromptGuard empowers enterprises to take back control of their data, by actively monitoring prompts written into chatbots like Google AI Mode and ChatGPT for sensitive data **fully on-device** and warning employees if any is found, with configurable policies coming soon. ![](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/927/632/datas/gallery.jpg)

5. **Chatbots as therapists** - chatbots aren't equipped to handle teen mental health concerns; and yet, many youths turn to them for mental health support, introducing hidden hazards. By non-intrusively monitoring chatbot prompts, SwiftGuardian can detect signs of distress and report back to parents, allowing them to spot distress early.

## How we built it

As a Chrome extension, SwiftGuardian is primarily built with web technologies like HTML, Javascript and CSS.

### Multimodal Prompt API

We use Chrome Built-In AI's **Multimodal Prompt API** to visually perceive webpages to pick up cues that text extraction simply cannot, such as page styling and element layouts. Built-in AI can then perceive the webpage exactly how a human would.

![](https://d112y698adiu2z.cloudfront.net/photos/production/software_photos/003/928/184/datas/gallery.jpg)

### Chain-of-Thought Prompting

**Further, we prompt-engineered Chrome's Built-in AI to reason before coming to its verdict on webpages despite it not being a native reasoning model, using advanced Chain-of-Thought prompting techniques to control its reasoning. This drastically increased output accuracy.**

A sample prompt we created after dozens of iterations:

> Reason for 2 sentences carefully about the most appropriate label, and then produce the label with a '_291aec' suffix without spaces.
> For your reasoning, it should be something like, "Hmm, I am looking at a page where ..., ..., hence it is likely a ..., because ...".
>
> The verdict must be the very last part of your response.
> It is extremely critical that you classify it correctly.

### Hybrid Inference

SwiftGuardian uses **Firebase AI Logic's hybrid inference** to deliver powerful protection to devices big and small, across all performance classes, with a clear data toggle so users are always in control.

## Challenges we ran into

**Prompt engineering and pipeline** - initially, we tried to provide Gemini Nano with many different tools and classification tasks in a single prompt, which did not produce expected results.

We then realised that with smaller, local on-device LLMs, simplest is best; so, we broke up the task into several smaller tasks - a pre-classification step, and then a router which chooses the correct pipeline to run. With Gemini Nano's speed, this produced a huge increase in output accuracy and negligible increase in runtime, and webpages could still be classified within seconds.

## Accomplishments that we're proud of

Producing a Chrome extension of such complexity was extremely rewarding; knowing that it has so much potential to protect users from online threats makes us proud.

## What we learned

Use the given tools correctly - prompt engineering techniques and overall LLM orchestration are very different when working with an on-device smaller LLM compared to working with a cloud-hosted 480b one.

## What's next for SwiftGuardian

- Allow IT administrators to create custom policies for enterprise data protection with PromptGuard, tailoring the LLM prompt scanning to fit each organisation's individual needs

- Release on Chrome Extension Store?

