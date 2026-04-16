from PIL import Image
import io
import fitz  # PyMuPDF
import sys
import os

def extract_images_from_pdf(pdf_path, output_dir):
    try:
        # Create output directory if it doesn't exist
        os.makedirs(output_dir, exist_ok=True)
        
        # Open the PDF document
        doc = fitz.open(pdf_path)
        extracted_files = []
        
        # Iterate through each page
        for page_index in range(len(doc)):
            page = doc[page_index]
            # Get a list of images on the current page
            image_list = page.get_images(full=True)
            
            for img_index, img in enumerate(image_list):
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                
                # Convert to WebP using Pillow
                try:
                    img_data = Image.open(io.BytesIO(image_bytes))
                    filename = f"image_p{page_index + 1}_{img_index + 1}.webp"
                    filepath = os.path.join(output_dir, filename)
                    
                    # Save as WebP with optimized quality
                    img_data.save(filepath, "WEBP", quality=80, method=6)
                    extracted_files.append(filepath)
                except Exception as e:
                    print(f"Warning: Could not convert image {img_index} on page {page_index+1} to WebP: {e}")
                    # Fallback to original if conversion fails
                    image_ext = base_image["ext"]
                    filename = f"image_p{page_index + 1}_{img_index + 1}.{image_ext}"
                    filepath = os.path.join(output_dir, filename)
                    with open(filepath, "wb") as f:
                        f.write(image_bytes)
                    extracted_files.append(filepath)
                
        if extracted_files:
            print(f"Extraction complete. Found {len(extracted_files)} images.")
            print("Extracted files:")
            for f in extracted_files:
                print(f)
        else:
            print("No images found in the PDF.")
            
    except Exception as e:
        print(f"Error extracting images: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python extract_images.py <path_to_pdf> <output_directory>")
        print("Example: python extract_images.py sample.pdf public/images/units/unit1")
        sys.exit(1)
        
    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    if not os.path.exists(pdf_path):
        print(f"Error: PDF file '{pdf_path}' not found.")
        sys.exit(1)
        
    # Standardize paths
    pdf_path = os.path.abspath(pdf_path)
    output_dir = os.path.abspath(output_dir)
    
    extract_images_from_pdf(pdf_path, output_dir)
