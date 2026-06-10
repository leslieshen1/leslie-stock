// Remove image background using macOS Vision foreground instance mask.
// Usage: swift cutout.swift input.png output.png
import Vision
import CoreImage
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else { fatalError("usage: cutout.swift in.png out.png") }
guard let ciImage = CIImage(contentsOf: URL(fileURLWithPath: args[1])) else {
    fatalError("cannot load \(args[1])")
}

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: ciImage)
try handler.perform([request])
guard let result = request.results?.first else { fatalError("no foreground found") }

let maskBuffer = try result.generateScaledMaskForImage(
    forInstances: result.allInstances, from: handler)
let mask = CIImage(cvPixelBuffer: maskBuffer)

let blend = CIFilter(name: "CIBlendWithMask")!
blend.setValue(ciImage, forKey: kCIInputImageKey)
blend.setValue(CIImage(color: .clear).cropped(to: ciImage.extent),
               forKey: kCIInputBackgroundImageKey)
blend.setValue(mask, forKey: kCIInputMaskImageKey)
guard let output = blend.outputImage else { fatalError("blend failed") }

let ctx = CIContext()
guard let cg = ctx.createCGImage(output, from: ciImage.extent) else {
    fatalError("render failed")
}
let rep = NSBitmapImageRep(cgImage: cg)
guard let png = rep.representation(using: .png, properties: [:]) else {
    fatalError("png encode failed")
}
try png.write(to: URL(fileURLWithPath: args[2]))
print("saved -> \(args[2])")
